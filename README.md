# Cally
Calendar Assistant Agent

## Getting Started

### Prerequisites

- Node.js 20 or newer
- npm

### Install Dependencies

```bash
npm install
```

### Run the project locally

```bash
npm run dev
```

This starts the Next.js development server.

### Build for production

```bash
npm run build
```

### Run the tests

```bash
npm run test
```

I have tests for:
- OAuth State
- OAuth Callback route and error handling
- Agent Behavior/Scheduling Events
- Fetching Calendar Events
- App Origin


### Lint the code

```bash
npm run lint
```

## Notes

- The app reads environment variables from `.env` when present.
- If you change dependencies, rerun `npm install` before starting the app again.
