/**
 * Typed re-export of ./password.mjs.
 *
 * The logic lives in the .mjs file so it can be unit-tested directly by
 * `node --test` with no loader. This module exists so application code keeps
 * importing from '@/lib/password' and gets full types.
 */
export {
  hashPassword,
  verifyPassword,
  burnPasswordTime,
  validatePassword,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
} from './password.mjs';

/** Shape returned by validatePassword when the password is unacceptable. */
export interface PasswordProblem {
  message: string;
}
