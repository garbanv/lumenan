// @ts-check

import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { buildGeoDb, isStale, lookupCountry, parseIp } from "../lib/geoip.mjs"
import { downloadGeoIp, monthUrls } from "../lib/geoip-download.mjs"

const CSV = [
  "0.0.0.0,0.255.255.255,ZZ",
  "1.0.0.0,1.0.0.255,AU",
  "1.0.1.0,1.0.3.255,CN",
  "81.0.0.0,81.255.255.255,ES",
  "203.0.113.0,203.0.113.255,FR",
  "255.255.255.0,255.255.255.255,US",
  "2001:200::,2001:200:ffff:ffff:ffff:ffff:ffff:ffff,JP",
  "2a00:1450::,2a00:1450:ffff:ffff:ffff:ffff:ffff:ffff,IE",
  "ffff:ffff::,ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff,DE",
].join("\n")

const db = buildGeoDb(CSV)

test("IPv4: inside a range, at both edges, and between ranges", () => {
  assert.equal(lookupCountry(db, "81.46.10.7"), "ES")
  assert.equal(lookupCountry(db, "81.0.0.0"), "ES")
  assert.equal(lookupCountry(db, "81.255.255.255"), "ES")
  assert.equal(lookupCountry(db, "1.0.0.255"), "AU")
  assert.equal(lookupCountry(db, "1.0.1.0"), "CN")
  assert.equal(lookupCountry(db, "80.255.255.255"), null, "just below a range")
  assert.equal(lookupCountry(db, "82.0.0.0"), null, "just above a range")
})

test("IPv4: the lowest and highest addresses work (unsigned arithmetic)", () => {
  assert.equal(lookupCountry(db, "255.255.255.255"), "US")
  assert.equal(lookupCountry(db, "128.0.0.1"), null)
})

test('"ZZ" (unknown) ranges are not reported as a country', () => {
  assert.equal(lookupCountry(db, "0.1.2.3"), null)
})

test("IPv6: matched on the top 64 bits", () => {
  assert.equal(lookupCountry(db, "2001:200::1"), "JP")
  assert.equal(lookupCountry(db, "2a00:1450:4003:80f::200e"), "IE")
  assert.equal(lookupCountry(db, "ffff:ffff:1:2:3:4:5:6"), "DE")
  assert.equal(lookupCountry(db, "2001:201::1"), null)
  assert.equal(
    lookupCountry(db, "::1"),
    null,
    "loopback is not in the database",
  )
})

test("IPv4-mapped IPv6 addresses are looked up as IPv4", () => {
  assert.equal(lookupCountry(db, "::ffff:81.46.10.7"), "ES")
  assert.equal(lookupCountry(db, "::ffff:5100:0a07"), "ES")
})

test("bracketed addresses and zone ids are tolerated", () => {
  assert.equal(lookupCountry(db, "[2001:200::1]"), "JP")
  assert.equal(lookupCountry(db, "2001:200::1%eth0"), "JP")
})

test("junk input never throws and yields null", () => {
  for (const bad of [
    "",
    "not an ip",
    "1.2.3",
    "1.2.3.4.5",
    "999.1.1.1",
    "1::2::3",
    "gggg::1",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(lookupCountry(db, bad), null, String(bad))
  }
  assert.equal(parseIp("1.2.3.4")?.family, 4)
  assert.equal(parseIp("::1")?.family, 6)
  assert.equal(parseIp("x"), null)
})

test("no database loaded -> null, not an error", () => {
  assert.equal(lookupCountry(null, "81.46.10.7"), null)
  assert.equal(lookupCountry(undefined, "81.46.10.7"), null)
})

test("input order does not matter: the tables are sorted on load", () => {
  const shuffled = buildGeoDb(CSV.split("\n").reverse().join("\n"))
  assert.equal(lookupCountry(shuffled, "81.46.10.7"), "ES")
  assert.equal(lookupCountry(shuffled, "203.0.113.9"), "FR")
  assert.equal(lookupCountry(shuffled, "2a00:1450::1"), "IE")
})

test("optional quotes, CRLF line endings and lower-case codes are accepted", () => {
  const quoted = buildGeoDb(
    '"81.0.0.0","81.255.255.255","es"\r\n"1.0.0.0","1.0.0.255","AU"\r\n',
  )
  assert.equal(lookupCountry(quoted, "81.1.1.1"), "ES")
  assert.equal(lookupCountry(quoted, "1.0.0.9"), "AU")
})

test("bad lines are skipped and counted; a file with none usable throws", () => {
  const partial = buildGeoDb(`${CSV}\nthis,is,not\n1.2.3.4,1.2.3.1,ES\n,,\n`)
  assert.ok(partial.skipped >= 2)
  assert.equal(lookupCountry(partial, "81.46.10.7"), "ES")

  assert.throws(
    () => buildGeoDb("<html><body>Not found</body></html>"),
    /No usable ranges/,
  )
  assert.throws(() => buildGeoDb(""), /No usable ranges/)
})

test("isStale: missing file, fresh file, old file", () => {
  const now = Date.parse("2026-10-19T00:00:00Z")
  const day = 24 * 60 * 60 * 1000
  assert.equal(isStale(null, now), true)
  assert.equal(isStale(now - 5 * day, now), false)
  assert.equal(isStale(now - 41 * day, now), true)
  assert.equal(isStale(now - 10 * day, now, 7), true)
})

// ---- downloader -----------------------------------------------------------

/** A CSV big enough to pass the plausibility check, with a known range in it. */
function bigCsv(rows = 60) {
  const lines = ["81.0.0.0,81.255.255.255,ES"]
  for (let i = 1; i < rows; i++)
    lines.push(
      `${100 + (i >> 8)}.${i & 255}.0.0,${100 + (i >> 8)}.${i & 255}.255.255,FR`,
    )
  return lines.join("\n")
}

/** @param {number} status @param {Buffer | string} body */
const respond = (status, body) =>
  new Response(typeof body === "string" ? body : new Uint8Array(body), {
    status,
  })

test("monthUrls: current month first, then the previous one, across a year boundary", () => {
  assert.deepEqual(monthUrls(new Date("2026-10-19T12:00:00Z")), [
    "https://download.db-ip.com/free/dbip-country-lite-2026-10.csv.gz",
    "https://download.db-ip.com/free/dbip-country-lite-2026-09.csv.gz",
  ])
  assert.deepEqual(monthUrls(new Date("2027-01-01T00:30:00Z")), [
    "https://download.db-ip.com/free/dbip-country-lite-2027-01.csv.gz",
    "https://download.db-ip.com/free/dbip-country-lite-2026-12.csv.gz",
  ])
})

test("downloader: falls back to last month when this month is not published yet", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "geoip-"))
  try {
    const out = path.join(dir, "sub", "db.csv.gz")
    const gz = gzipSync(bigCsv())
    /** @type {string[]} */
    const asked = []
    const result = await downloadGeoIp({
      out,
      now: new Date("2026-10-01T00:05:00Z"),
      minRows: 50,
      fetchImpl: /** @type {any} */ (
        async (/** @type {string} */ url) => {
          asked.push(url)
          return url.includes("2026-10")
            ? respond(404, "nope")
            : respond(200, gz)
        }
      ),
    })
    assert.equal(asked.length, 2)
    assert.match(result.url, /2026-09/)
    assert.equal(
      lookupCountry(
        buildGeoDb(
          (await import("node:zlib"))
            .gunzipSync(await readFile(out))
            .toString(),
        ),
        "81.2.3.4",
      ),
      "ES",
    )
    assert.deepEqual(
      await readdir(path.dirname(out)),
      ["db.csv.gz"],
      "no temp file left behind",
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("downloader: a bogus download never replaces a working database", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "geoip-"))
  try {
    const out = path.join(dir, "db.csv.gz")
    await writeFile(out, "GOOD-EXISTING-FILE")

    const cases = /** @type {Array<[string, () => Response]>} */ ([
      ["http error", () => respond(500, "boom")],
      ["html page, not gzip", () => respond(200, "<html>captcha</html>")],
      ["gzip of html", () => respond(200, gzipSync("<html>captcha</html>"))],
      ["too few ranges", () => respond(200, gzipSync(bigCsv(5)))],
    ])
    for (const [name, make] of cases) {
      await assert.rejects(
        downloadGeoIp({
          out,
          minRows: 50,
          fetchImpl: /** @type {any} */ (async () => make()),
        }),
        /Could not download/,
        name,
      )
      assert.equal(
        await readFile(out, "utf8"),
        "GOOD-EXISTING-FILE",
        `${name}: existing file untouched`,
      )
    }
    assert.deepEqual(await readdir(dir), ["db.csv.gz"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("downloader: a network failure is reported, not thrown raw", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "geoip-"))
  try {
    await assert.rejects(
      downloadGeoIp({
        out: path.join(dir, "db.csv.gz"),
        fetchImpl: /** @type {any} */ (
          async () => {
            throw new Error("getaddrinfo ENOTFOUND")
          }
        ),
      }),
      /ENOTFOUND/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
