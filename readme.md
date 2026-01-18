# SecureXfer

SecureXfer is a simple and secure file transfer application designed to copy files between computers (PC or Mac) on the same WiFi network. Built with Electron, React, and Vite, it provides a premium user experience with automatic device discovery and a manual confirmation step for security.

## Features

- **Zero Configuration**: Automatically discovers other devices on your WiFi using mDNS.
- **TLS Encryption**: All transfers are encrypted using HTTPS with self-signed certificates.
- **Fingerprint Pinning**: Peers verify certificate fingerprints via mDNS to prevent man-in-the-middle attacks.
- **Manual Approval**: Incoming transfers must be explicitly accepted by the recipient before data begins to transfer.
- **Cross-Platform**: Seamlessly transfer files between Windows and macOS.
- **Modern UI**: A clean, dark-mode interface with smooth animations and real-time progress updates.
- **Automatic Saving**: Files are automatically saved to your standard `Downloads` folder.

## How It Works

1.  **Identity**: On startup, the app generates a unique self-signed certificate and calculates its SHA-256 fingerprint.
2.  **Discovery**: The app announces itself on the local network via mDNS, including its certificate fingerprint in the broadcast.
3.  **Selection**: Select a device. The app uses the discovered fingerprint to ensure it's connecting to the correct, secure instance.
4.  **Handshake**: A secure request is sent to the recipient. They see a modal with the transfer details.
5.  **Secure Transfer**: If accepted, the file is streamed over an encrypted HTTPS connection with strict fingerprint validation.

## Security Features

> [!IMPORTANT]
> **End-to-End Encryption**: Data is encrypted in transit using TLS 1.3.
>
> **Identity Verification**: SecureXfer uses "Fingerprint Pinning". The certificate fingerprint is shared via mDNS (local network broadcast) and verified before any data is sent. This prevents impersonation on the local network.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- [npm](https://www.npmjs.com/)

### Installation

```bash
# Clone the repository (or copy the files)
cd SecureXfer

# Install dependencies
npm install
```

### Running in Development

```bash
npm run dev
```

### Building for Distribution

#### Windows
```bash
# To build a portable executable or installer
npm run build
```
The output will be in the `release/win-unpacked` directory.

#### macOS
```bash
# To build for Mac, run this on a macOS machine
npm run build
```
The output will be in the `release/mac` directory.

## Technical Details

- **Backend**: Electron (Main Process), Node.js, Express, Socket.io, mDNS.
- **Frontend**: React, Vite, Framer Motion, Tailwind CSS (via styling).
- **Discovery**: Multicast DNS (`multicast-dns`).
- **Transfer**: HTTP POST streaming with `axios` and `fs.createReadStream`.

## Testing

SecureXfer includes both unit tests and end-to-end (E2E) tests to ensure reliability and quality.

### Test Suite Overview

- **Unit Tests**: Test individual utility functions and components using Vitest
- **E2E Tests**: Test the complete application flow using Playwright for Electron

### Running Tests

#### Run All Unit Tests
```bash
npm test
```

This runs all unit tests in watch mode. Tests are located in files matching the pattern `*.test.ts` or `*.test.tsx` (excluding the `e2e/` directory).

**Example output:**
```
✓ src/utils.test.ts (5 tests) 2ms
  Test Files  1 passed (1)
       Tests  5 passed (5)
```

#### Run E2E Tests
```bash
npm run test:e2e
```

This launches the Electron application via Playwright and runs automated UI tests. E2E tests are located in the `e2e/` directory.

**Example output:**
```
Running 1 test using 1 worker
✓ [electron] › smoke.test.ts:4:5 › smoke test (1.4s)
  1 passed (1.4s)
```

#### Run E2E Tests with UI
```bash
npm run test:e2e:ui
```

Opens Playwright's interactive test UI, allowing you to:
- Watch tests run in real-time
- Debug test failures
- Inspect the application state
- Step through test execution

### Test Structure

#### Unit Tests (`src/utils.test.ts`)
Tests for utility functions like `formatBytes`:
```typescript
import { describe, it, expect } from 'vitest'
import { formatBytes } from './utils'

describe('formatBytes', () => {
  it('formats bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 Bytes')
    expect(formatBytes(1024)).toBe('1 KB')
    // ...
  })
})
```

#### E2E Tests (`e2e/smoke.test.ts`)
Tests for the complete application:
```typescript
import { _electron as electron } from '@playwright/test'
import { test, expect } from '@playwright/test'

test('smoke test - proper electron launch', async () => {
  const electronApp = await electron.launch({ args: ['.'] })
  const window = await electronApp.firstWindow()
  await window.waitForSelector('.logo-text')
  await expect(window.locator('.logo-text')).toHaveText('SecureXfer')
  await electronApp.close()
})
```

### Adding New Tests

#### Adding Unit Tests
1. Create a new file with the `.test.ts` or `.test.tsx` extension
2. Import the function/component to test
3. Write test cases using Vitest's `describe`, `it`, and `expect`
4. Run `npm test` to verify

#### Adding E2E Tests
1. Create a new file in the `e2e/` directory with the `.test.ts` extension
2. Import Playwright's Electron helpers
3. Write test scenarios that interact with the UI
4. Run `npm run test:e2e` to verify

### Troubleshooting

#### E2E Tests Fail to Launch

**Issue**: "Process failed to launch!" error

**Solution**: This is typically caused by Playwright version incompatibility. SecureXfer requires Playwright 1.43.1 due to a regression in later versions.

```bash
npm install --save-dev @playwright/test@1.43.1
```

**Why?** Playwright 1.44+ passes `--remote-debugging-port=0` to Electron, which Electron doesn't recognize as a valid flag, causing immediate exit.

#### Unit Tests Not Running

**Issue**: Tests don't execute or Vitest doesn't start

**Solution**: Ensure Vitest is installed and the test file matches the pattern:
```bash
npm install --save-dev vitest
```

Test files must:
- Be named `*.test.ts` or `*.test.tsx`
- Not be in the `e2e/` directory (excluded in `vite.config.ts`)

#### E2E Tests Timeout

**Issue**: Tests timeout waiting for elements

**Solution**: Increase timeout in the test or check if the application is building correctly:
```typescript
await window.waitForSelector('.logo-text', { timeout: 30000 }) // 30 seconds
```

Also verify the build is up-to-date:
```bash
npm run build
npm run test:e2e
```

### Test Configuration

#### Vitest Configuration (`vite.config.ts`)
```typescript
test: {
  environment: 'node',
  globals: true,
  exclude: ['e2e/**', 'node_modules/**']
}
```

#### Playwright Configuration (`playwright.config.ts`)
```typescript
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  projects: [{ name: 'electron' }]
})
```

### Continuous Integration

For CI/CD pipelines, run both test suites:
```bash
# Run unit tests (fast)
npm test -- --run

# Run E2E tests (slower, requires display)
npm run test:e2e
```

> [!NOTE]
> E2E tests require a display environment. For headless CI, you may need to use `xvfb` on Linux or ensure a virtual display is available.

### Best Practices

1. **Unit Test First**: Write unit tests for utility functions and business logic
2. **E2E for Critical Paths**: Use E2E tests for critical user flows (launch, file transfer, etc.)
3. **Keep Tests Fast**: Unit tests should run in milliseconds; E2E tests in seconds
4. **Isolate Tests**: Each test should be independent and not rely on others
5. **Use Descriptive Names**: Test names should clearly describe what they verify
6. **Mock External Dependencies**: Use mocks for network calls, file system, etc. in unit tests

### Coverage

To generate test coverage reports:
```bash
npm test -- --coverage
```

This will show which parts of the codebase are covered by tests.


## License

MIT
