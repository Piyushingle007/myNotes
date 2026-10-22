# 🤝 Contributing to myNotes

Thank you for your interest in contributing to **myNotes**! We welcome bug reports, feature suggestions, documentation improvements, and pull requests from everyone.

---

## 📜 Code of Conduct

Please treat all contributors and community members with respect, kindness, and empathy. We are committed to providing a welcoming, constructive, and inclusive environment.

---

## 🛠️ Development Setup

### 1. Prerequisites
- **Node.js ≥ 22.x**
- **npm ≥ 10.x**
- For Android: Android Studio & JDK 17+
- For macOS Desktop: macOS with Xcode Command Line Tools

### 2. Clone and Install
```bash
git clone https://github.com/Piyushingle007/myNotes.git
cd myNotes

# Install web dependencies
npm install

# (Optional) Install desktop shell dependencies
cd electron && npm install && cd ..
```

### 3. Running the App
```bash
# Start Vite development server with HMR
npm run dev

# Open in browser: http://localhost:5173
```

### 4. Running Verification Checks
Before submitting changes, make sure your code builds cleanly:
```bash
# Svelte and TypeScript static check
npm run check

# Production build
npm run build
```

---

## 🚀 Working Across Targets

- **Web (PWA)**: Tested via `npm run dev` and `npm run preview`.
- **Android App**:
  ```bash
  npm run build:android  # Syncs build to android/
  npm run cap:open       # Opens project in Android Studio
  npm run build:apk      # Builds debug APK
  ```
- **macOS Desktop App**:
  ```bash
  npm run mac:run        # Runs Electron desktop app locally
  npm run mac:pack       # Packs desktop bundle
  ```

---

## 📌 Commit Message Conventions

We encourage [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` A new user-facing feature
- `fix:` A bug fix
- `docs:` Documentation updates
- `style:` Code style, formatting, UI polish without logic changes
- `refactor:` Code refactoring without behavioral alterations
- `perf:` Performance improvements
- `test:` Adding or updating tests
- `chore:` Dependency bumps, build tool configurations

---

## 📤 Submitting a Pull Request

1. Fork the repository and create your branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Commit your changes with clear, descriptive commit messages.
3. Verify that `npm run build` succeeds without errors.
4. Push your branch to GitHub and submit a Pull Request.
5. Provide a summary of your changes, motivation, and screenshots or video clips for visual modifications.
