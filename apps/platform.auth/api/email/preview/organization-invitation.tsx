// Preview harness for `react-email dev`. Not shipped, not imported by the app —
// each file default-exports one template with realistic props so the copy can be
// read at the size a person will read it. Excluded from fallow in .fallowrc.jsonc.
import { OrganizationInvitation } from "../templates.tsx";

const props = {
  url: "https://auth.somewhatintelligent.ca/api/auth/accept-invitation/inv_7f3a",
  organization: "somewhatintelligent",
  invitedBy: "Apostoli",
  expiresIn: "7 days",
};

export default function Preview() {
  return <OrganizationInvitation {...props} />;
}
