# React Native app

Boots to the baseline credit-line flow. Start the mock API first:

```bash
cd ../mock-api
npm start
```

Then, in another terminal:

```bash
npm install
npm run web
```

Use `npm run ios` or `npm run android` for a simulator/emulator. `src/apiClient.ts`
handles HTTP so you don't have to. `src/tokens.ts` has colors, spacing, and type. Use
them and don't spend time on visual design.

Android emulators use `10.0.2.2` automatically. iOS simulators and web use
`localhost`. To use Expo Go on a physical device, run Expo with your computer's LAN
address, for example:

```bash
EXPO_PUBLIC_API_HOST=192.168.1.20 npm start
```

Run `npm run typecheck` for the baseline's static check.
