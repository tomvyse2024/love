# Cash Receive System — PWA package

This package preserves the original Cash Receive System design and JavaScript logic, and adds the files needed for an installable Progressive Web App (PWA).

## Files
- `index.html` — original page with PWA metadata and service-worker registration added
- `manifest.json` — app name, standalone display mode, and icon declarations
- `sw.js` — app-shell caching and basic offline fallback
- `icons/icon-192.png` and `icons/icon-512.png` — app icons

## Upload to GitHub Pages
Upload these files/folders into the same folder where your existing `index.html` lives:
- `index.html`
- `manifest.json`
- `sw.js`
- `icons/` folder

Keep your existing `kpay.png` beside `index.html`, because the original design references it. It was not included in the pasted source file.

## Install on Android
1. Open the published HTTPS GitHub Pages URL in Chrome.
2. Open the three-dot menu.
3. Choose `Install app` if shown, otherwise `Add to Home screen`.
4. Launch using the new home-screen icon.

## Notes
- The original page design, form flow, receipt frame, keypad, and JavaScript were kept as supplied.
- QR generation still loads the original QRCodeJS library from a CDN, so generating QR codes requires internet unless that library is separately downloaded and configured locally.
- This is a demo receipt UI as the original disclaimer says; it does not verify real payments.
- The original password check is client-side in JavaScript and is not secure authentication. Do not use it to protect real/private data.


UPDATED VERSION NOTES
- Page 2 transfer form restyled to match the provided reference image while retaining the existing blue/white theme.
- Customer phone number appears in parentheses directly after the customer name.
- Amount field uses the phone's native numeric keyboard.
- Transfer button stays dim/disabled until amount, notes, and a transaction type are selected.
- Password keypad removes Clear, Cancel, and Enter; the close X remains.
- Entering the six-digit password 301120 automatically continues to the receipt page.
- Keep kpay.png beside index.html in the GitHub Pages repository.
