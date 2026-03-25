declare module 'argon2-browser/dist/argon2-bundled.min.js' {
  export enum ArgonType {
    Argon2d = 0,
    Argon2i = 1,
    Argon2id = 2,
  }

  export interface Argon2HashResult {
    hash: Uint8Array;
    hashHex: string;
    encoded: string;
  }

  export interface Argon2HashParams {
    pass: string | Uint8Array;
    salt: string | Uint8Array;
    time: number;
    mem: number;
    parallelism: number;
    hashLen: number;
    type: ArgonType;
  }

  export function hash(params: Argon2HashParams): Promise<Argon2HashResult>;
}
