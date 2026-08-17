import { IS_TAURI } from '../lib/files'
import '../css/Welcome.css'

export default function Welcome({ onOpenFolder }) {
  return (
    <div className="Welcome">
      <div className="Welcome__logo">
        <img src="/icon.png" alt="" width="76" height="76" />
      </div>
      <h1 className="Welcome__title">
        Bluebird <span>Writer</span>
      </h1>
      <p className="Welcome__sub">
        A quiet place to write. Plain markdown files, saved straight to a folder
        on your disk — no account, no cloud, no lock-in.
      </p>
      <button className="Welcome__cta" onClick={onOpenFolder}>
        {IS_TAURI ? 'Choose a folder' : 'Try the demo'}
      </button>
      {!IS_TAURI && (
        <p className="Welcome__hint">
          You're in a browser, so this opens a sample workspace kept in memory.
          Run the desktop app to work with real files.
        </p>
      )}
    </div>
  )
}
