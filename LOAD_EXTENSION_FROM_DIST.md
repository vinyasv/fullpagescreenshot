# Load the compiled extension

In Chrome, go to `chrome://extensions` → **Load unpacked** → select:

`/Users/vinyas/Desktop/gofullpage/dist`

The project root contains TypeScript source and cannot be loaded directly. If you previously selected the root, remove that broken entry before loading `dist`. After code changes, run `npm run build` and click **Reload** on the `dist` extension.

For a Chrome Web Store draft upload, use `fullpage-screenshot-extension.zip` after running `npm run package`.
