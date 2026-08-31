/**
 * Local types for @garmin/fitsdk.
 *
 * The package ships its own declarations, but they are unusable under this
 * project's `moduleResolution: "NodeNext"`: `src/index.d.ts` re-exports with
 * extensionless relative specifiers (`export * from './types/decoder'`),
 * which NodeNext does not resolve for an ESM package. tsc therefore reports
 * "no exported member 'Decoder'" for a named import that works perfectly at
 * runtime — verified directly against the installed package.
 *
 * So this declares only the surface modules/imports/workoutFile.ts actually
 * uses, rather than switching the whole project's module resolution to suit
 * one dependency's packaging.
 *
 * If a later release fixes the extensions, delete this file — tsc will keep
 * passing on the package's own, richer types.
 */
declare module "@garmin/fitsdk" {
  export class Stream {
    static fromBuffer(buffer: Uint8Array): Stream;
    static fromByteArray(data: number[] | Uint8Array): Stream;
    static fromArrayBuffer(buffer: ArrayBuffer): Stream;
  }

  export class Decoder {
    constructor(stream: Stream);
    static isFIT(stream: Stream): boolean;
    isFIT(): boolean;
    checkIntegrity(): boolean;
    /** Message collections are keyed by message name, e.g. `sessionMesgs`, `recordMesgs`. */
    read(options?: Record<string, unknown>): {
      messages: Record<string, unknown[]>;
      errors: Error[];
    };
  }
}
