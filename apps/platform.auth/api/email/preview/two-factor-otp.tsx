// Preview harness for `react-email dev`. Not shipped, not imported by the app —
// each file default-exports one template with realistic props so the copy can be
// read at the size a person will read it. Excluded from fallow in .fallowrc.jsonc.
import { TwoFactorOtp } from "../templates.tsx";

const props = {
  origin: "https://accounts.somewhatintelligent.ca",
  code: "418205",
  email: "researcher@somewhatintelligent.com",
  expiresIn: "30 seconds",
};

export default function Preview() {
  return <TwoFactorOtp {...props} />;
}
