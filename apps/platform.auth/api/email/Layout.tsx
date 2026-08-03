import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Column,
  Section,
  Text,
} from "@react-email/components";
import { button, color, font, layout } from "platform.design/generated/email/tokens.ts";
import { PRODUCTION_ZONE } from "platform.names";

/**
 * The chrome every auth email shares, and the rules it enforces by being the
 * only way to build one.
 *
 * Read `docs/design/somewhatintelligent-brand-study` for why it looks like
 * this. The short version: an email from here is a RECORD, not a greeting.
 * Institutional masthead, cold-paper ground, a claim set large, metadata in
 * mono, and exactly one breach where something too personal for the document
 * gets in anyway.
 *
 * Everything is inline style. Mail clients strip `<style>` and resolve no
 * `var()`, which is why the values come from a generated module rather than
 * the CSS tokens — see `platform.design/scripts/codegen.ts`.
 */

const HOST = `auth.${PRODUCTION_ZONE}`;

/**
 * ONE per email. The brand study is explicit that repetition turns a breach
 * into wallpaper — "use one leak, not twelve" — so this is a prop on the shell
 * rather than a component a template can scatter.
 *
 * Set in the accent italic and the `friend` pink, which is the only place pink
 * appears. It should read as handwriting on an official form.
 */
export interface Leak {
  readonly text: string;
}

export interface RecordRow {
  readonly label: string;
  readonly value: string;
}

export interface LayoutProps {
  /** The `<title>`. Not shown by most clients, but assistive tech reads it. */
  readonly title: string;
  /** The preview line. Say what happened, never "open this email". */
  readonly preview: string;
  /** The claim, set large and condensed. Uppercase by construction. */
  readonly heading: string;
  readonly leak: Leak;
  /** Documentary metadata — mono, uppercase label, plain value. */
  readonly record?: ReadonlyArray<RecordRow>;
  readonly children: React.ReactNode;
}

export function Layout({ title, preview, heading, leak, record, children }: LayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <title>{title}</title>
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: color.background,
          color: color.foreground,
          fontFamily: font.body,
          margin: 0,
          padding: 0,
        }}
      >
        {/*
         * The institutional masthead. UPPERCASE is deliberate and rare: the
         * brand is lowercase in ordinary use and takes capitals only when the
         * voice is explicitly institutional — legal lines, garment labels,
         * shipping marks. A machine-sent account record is that voice.
         */}
        <Section style={{ backgroundColor: color.inverse, padding: "18px 0" }}>
          <Container style={{ maxWidth: layout.maxWidth, margin: "0 auto", padding: "0 24px" }}>
            <Row>
              <Column>
                <Text
                  style={{
                    margin: 0,
                    fontFamily: font.display,
                    fontSize: "19px",
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    color: color.inverseForeground,
                  }}
                >
                  SOMEWHATINTELLIGENT
                </Text>
              </Column>
              <Column align="right">
                <Text
                  style={{
                    margin: 0,
                    fontFamily: font.mono,
                    fontSize: "10px",
                    letterSpacing: "0.14em",
                    color: color.mutedForeground,
                  }}
                >
                  IDENTITY
                </Text>
              </Column>
            </Row>
          </Container>
        </Section>

        <Container
          style={{
            maxWidth: layout.maxWidth,
            margin: "0 auto",
            padding: `${layout.gutter} 24px 40px`,
          }}
        >
          <Heading
            as="h1"
            style={{
              margin: "0 0 6px",
              fontFamily: font.display,
              fontSize: "44px",
              lineHeight: 0.94,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              textTransform: "uppercase",
              color: color.foreground,
            }}
          >
            {heading}
          </Heading>

          {/* THE BREACH. One per surface, and the only pink on it. */}
          <Text
            style={{
              margin: "0 0 26px",
              fontFamily: font.accent,
              fontStyle: "italic",
              fontSize: "15px",
              lineHeight: "22px",
              color: color.primary,
            }}
          >
            {leak.text}
          </Text>

          {children}

          {record && record.length > 0 ? (
            <Section
              style={{
                margin: "30px 0 0",
                border: `1px solid ${color.border}`,
                borderRadius: `${button.borderRadius}`,
              }}
            >
              {record.map((row, i) => (
                <Row
                  key={row.label}
                  style={{
                    borderTop: i === 0 ? undefined : `1px dotted ${color.border}`,
                  }}
                >
                  <Column style={{ padding: "11px 14px", width: "40%" }}>
                    <Text
                      style={{
                        margin: 0,
                        fontFamily: font.mono,
                        fontSize: "11px",
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: color.mutedForeground,
                      }}
                    >
                      {row.label}
                    </Text>
                  </Column>
                  <Column style={{ padding: "11px 14px" }}>
                    <Text
                      style={{
                        margin: 0,
                        fontFamily: font.mono,
                        fontSize: "12px",
                        color: color.foreground,
                        wordBreak: "break-word",
                      }}
                    >
                      {row.value}
                    </Text>
                  </Column>
                </Row>
              ))}
            </Section>
          ) : null}

          <Hr style={{ borderColor: color.border, margin: "34px 0 14px" }} />
          <Text
            style={{
              margin: "0 0 4px",
              fontFamily: font.mono,
              fontSize: "10px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: color.mutedForeground,
            }}
          >
            <Link href={`https://${HOST}`} style={{ color: color.mutedForeground }}>
              {HOST}
            </Link>
            {"  /  SENT BY A MACHINE, ON YOUR INSTRUCTION"}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Body copy. The patient paragraph the big claim is set against. */
export function Prose({ children }: { readonly children: React.ReactNode }) {
  return (
    <Text
      style={{
        margin: "0 0 16px",
        fontFamily: font.body,
        fontSize: "15px",
        lineHeight: "25px",
        color: color.secondaryForeground,
      }}
    >
      {children}
    </Text>
  );
}

/**
 * The one filled control, plus the URL in plain mono underneath.
 *
 * The fallback is not a courtesy — a client that strips the anchor leaves the
 * reader with no way through, and an auth email that cannot be completed is a
 * locked account.
 */
export function Action({
  href,
  label,
  destructive = false,
}: {
  readonly href: string;
  readonly label: string;
  readonly destructive?: boolean;
}) {
  return (
    <>
      <Section style={{ margin: "26px 0 18px" }}>
        <Link
          href={href}
          style={{
            ...button,
            backgroundColor: destructive ? color.destructive : button.backgroundColor,
          }}
        >
          {label}
        </Link>
      </Section>
      <Text
        style={{
          margin: 0,
          fontFamily: font.mono,
          fontSize: "11px",
          lineHeight: "18px",
          color: color.mutedForeground,
          wordBreak: "break-all",
        }}
      >
        {href}
      </Text>
    </>
  );
}

/** A one-time code, set as the evidence it is. */
export function Code({ code }: { readonly code: string }) {
  return (
    <Section
      style={{
        margin: "26px 0 18px",
        border: `1px solid ${color.borderStrong}`,
        borderRadius: `${button.borderRadius}`,
        padding: "20px",
        textAlign: "center",
      }}
    >
      <Text
        style={{
          margin: 0,
          fontFamily: font.mono,
          fontSize: "32px",
          fontWeight: 600,
          letterSpacing: "0.32em",
          color: color.foreground,
        }}
      >
        {code}
      </Text>
    </Section>
  );
}
