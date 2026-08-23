// `npm run braze:totp` — a code to type by hand, for when you are driving Braze
// yourself rather than letting a flow do it.
import { totp, totpTimeRemaining } from "./auth.mjs";
console.log(`${await totp()}   (valid for ${totpTimeRemaining()}s)`);
