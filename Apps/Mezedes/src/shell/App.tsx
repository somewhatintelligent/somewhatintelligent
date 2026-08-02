import { useEffect, useState, type ReactElement } from "react";
import { Collection } from "./components/Collection.tsx";
import { Header } from "./components/Header.tsx";
import { Mezes } from "./components/Mezes.tsx";
import { useRoute } from "./components/router.ts";
import { useTheme } from "./components/theme.ts";

/**
 * Two screens: the collection at `/` and one mezes at `/m/:slug`. Everything
 * else — versions, settings, the preview and the code view — is state inside
 * the mezes screen, because none of it is worth a URL of its own and all of it
 * would lose the frame it belongs to.
 */
export const App = (): ReactElement => {
  const route = useRoute();
  const { theme, toggle } = useTheme();
  const [name, setName] = useState<string | null>(null);
  // The header's trailing slot, handed down so the mezes can portal its gear
  // menu into the one bar the app has. `null` until the header commits, and
  // again whenever the collection is showing.
  const [slot, setSlot] = useState<HTMLSpanElement | null>(null);

  // The slug stands in until the detail lands, so the crumb never blinks empty.
  const crumb = route.name === "mezes" ? (name ?? route.slug.replaceAll("-", " ")) : null;

  useEffect(() => {
    document.title = crumb === null ? "mezedes" : `${crumb} · mezedes`;
  }, [crumb]);

  return (
    <>
      <Header crumb={crumb} theme={theme} onToggleTheme={toggle} slotRef={setSlot} />
      <main>
        {route.name === "mezes" ? (
          // Keyed by slug: a different mezes is different state, not a patch.
          <Mezes key={route.slug} slug={route.slug} onName={setName} slot={slot} />
        ) : (
          <Collection />
        )}
      </main>
    </>
  );
};
