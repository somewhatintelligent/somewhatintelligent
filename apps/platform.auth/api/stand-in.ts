/**
 * A value that answers only what it was told and refuses everything else.
 *
 * TWO CALLERS, ONE MECHANISM, and the split that used to exist is what this file
 * exists to close. `inert.ts` needs it for the DEPLOY HOST, where `authConfig` is
 * resolved for the schema and the manifest but nothing it names exists yet.
 * `billing.ts` needs it inside the WORKER, for a Stripe client on a stage that
 * holds no credentials. Written twice, the two copies immediately disagreed
 * about symbols — see below — and only one of them was right.
 *
 * Returning `undefined` for an unknown field would let a value that quietly
 * matters be read and answered wrongly; the readers here depend on presence
 * alone, so any other read is a bug worth failing on.
 *
 * Deliberately dependency-free. `inert.ts` is kept out of the Worker bundle and
 * `billing.ts` ships in it, so the shared piece has to be cheap enough that
 * neither pays for the other.
 */

/**
 * @param key    what to name in the message — a service key, or a variable an
 *               operator would have to set.
 * @param known  the fields this stand-in can actually answer.
 * @param reason appended to every refusal; it is the only part that tells the
 *               reader what to DO, so it should name the fix.
 */
export const tripwire = <S>(key: string, known: Partial<S>, reason: string): S =>
  new Proxy(
    (): never => {
      throw new Error(`${key} was CALLED. ${reason}`);
    },
    {
      get: (_target, property): unknown => {
        /**
         * SYMBOLS ANSWER `undefined` RATHER THAN THROWING, and the carve-out is
         * not cosmetic: `Symbol.toPrimitive`, `Symbol.toStringTag` and the
         * inspect symbol are read by `String()`, by a logger formatting an
         * object, and by promise detection. Throwing there turns an incidental
         * `console.log` into a crash whose message points at the wrong thing —
         * a worse bug than the one this stand-in exists to report.
         */
        if (typeof property === "symbol") return undefined;
        if (property in known) return known[property as keyof S];
        throw new Error(`${key}.${property} was read. ${reason}`);
      },
    },
  ) as S;
