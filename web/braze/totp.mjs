// `npm run braze:totp` — a code to type by hand, and the quickest check that
// BRAZE_TOTP_SECRET is right: this should match your authenticator app.
import { totp, totpTimeRemaining } from "./auth.mjs";

try {
  console.log(`${await totp()}   (valid for ${totpTimeRemaining()}s)`);
} catch (err) {
  // Bundled deps are minified onto one line, so letting an error escape makes
  // Node print the whole bundle as the "source line". One line is enough.
  console.error(err.message);
  process.exit(1);
}
