/**
 * The lockup at the top of every auth screen.
 *
 * `viewTransitionName` is what makes it hold still while the card beneath it
 * morphs from sign-in to sign-up to reset — without it the mark cross-fades
 * with everything else and the whole screen reads as four separate pages.
 *
 * si drove the strings from an `appConfig.brand` object so a fork could rebrand
 * by editing one file. There is no fork, and the indirection cost a config
 * module, a per-app constant module, and an import alias to say two words.
 */
import { LogoIcon } from "@si/ui/components/logo";

export function Brand({ className, size = 64 }: { className?: string; size?: number }) {
  return (
    <div className={className}>
      <div className="flex flex-col items-center" style={{ viewTransitionName: "brand" }}>
        {/*
          `colors.stroke: currentColor` rather than a `colorScheme`, so the mark
          takes the surrounding text colour and follows the theme toggle. Every
          preset resolves to a LITERAL hex — they exist because satori cannot
          read a CSS custom property when it renders OG images — so any of them
          picks a side and stays there.

          Which side is easy to get wrong: si passed `colorScheme="light"`, and
          `ogColors.light` is documented as the stroke for LIGHT SURFACES, i.e.
          near-black ink. On this app's dark shell that renders the mark
          invisible, which is exactly what it did until someone looked at it.
        */}
        <LogoIcon
          size={size}
          colors={{ stroke: "currentColor", mainRect: "currentColor", shadowRect: "transparent" }}
        />
        <span className="mt-1 font-medium" style={{ fontSize: size * 0.28 }}>
          somewhat intelligent
        </span>
      </div>
    </div>
  );
}
