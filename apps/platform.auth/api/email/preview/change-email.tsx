// Preview harness for `react-email dev`. Not shipped, not imported by the app —
// each file default-exports one template with realistic props so the copy can be
// read at the size a person will read it. Excluded from fallow in .fallowrc.jsonc.
import { ChangeEmail } from "../templates.tsx";

const props = {
  url: "https://auth.somewhatintelligent.ca/verify?token=b8f2e1a4c9d0e7",
  email: "researcher@somewhatintelligent.com",
  expiresIn: "1 hour",
};

export default function Preview() {
  return <ChangeEmail {...props} />;
}
