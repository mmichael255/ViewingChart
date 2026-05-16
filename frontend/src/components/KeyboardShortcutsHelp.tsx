'use client';

interface ShortcutGroup {
  title: string;
  items: { keys: string; desc: string }[];
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: '/', desc: 'Open search modal' },
      { keys: '?', desc: 'Toggle keyboard shortcuts help' },
      { keys: 'Escape', desc: 'Close modal / cancel drawing / deselect tool' },
      { keys: 'Ctrl+B', desc: 'Toggle sidebar collapse' },
      { keys: 'Ctrl+Shift+]', desc: 'Next symbol in watchlist' },
      { keys: 'Ctrl+Shift+[', desc: 'Previous symbol in watchlist' },
    ],
  },
  {
    title: 'Drawing Tools',
    items: [
      { keys: '1', desc: 'Crosshair' },
      { keys: '2', desc: 'Trend Line' },
      { keys: '3', desc: 'Horizontal Line' },
      { keys: '4', desc: 'Vertical Line' },
      { keys: '5', desc: 'Ray' },
      { keys: '6', desc: 'Parallel Channel' },
      { keys: '7', desc: 'Fibonacci' },
      { keys: '8', desc: 'Rectangle' },
      { keys: '9', desc: 'Measure' },
      { keys: 'Delete', desc: 'Remove selected drawing' },
      { keys: '← / →', desc: 'Nudge selected drawing' },
    ],
  },
  {
    title: 'Time Intervals',
    items: [
      { keys: 'Ctrl+1', desc: '1 minute' },
      { keys: 'Ctrl+2', desc: '5 minutes' },
      { keys: 'Ctrl+3', desc: '15 minutes' },
      { keys: 'Ctrl+4', desc: '1 hour' },
      { keys: 'Ctrl+5', desc: '4 hours' },
      { keys: 'Ctrl+6', desc: '1 day' },
      { keys: 'Ctrl+7', desc: '1 week' },
      { keys: 'Ctrl+8', desc: '1 month' },
    ],
  },
  {
    title: 'Indicators & Chat',
    items: [
      { keys: 'Ctrl+I', desc: 'Toggle indicators config modal' },
      { keys: 'Ctrl+Shift+C', desc: 'Toggle chat widget' },
    ],
  },
  {
    title: 'Search Navigation',
    items: [
      { keys: '↑ / ↓', desc: 'Navigate search results' },
      { keys: 'Enter', desc: 'Select highlighted result' },
      { keys: 'Ctrl+,', desc: 'Switch between Crypto / Stocks & FX' },
    ],
  },
];

interface KeyboardShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#161B22] border border-[#21262D] rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#30363D] shrink-0">
          <div>
            <h2 className="text-lg font-black text-[#E6EDF3] tracking-tight">
              Keyboard Shortcuts
            </h2>
            <p className="text-xs text-[#8B949E] mt-1">
              Press <kbd className="px-1.5 py-0.5 rounded bg-[#0D1117] border border-[#30363D] text-[#D1D5DB] text-[10px] font-bold">?</kbd> to toggle this overlay
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#8B949E] hover:text-[#E6EDF3] transition-colors p-1 rounded hover:bg-[#30363D]/50"
          >
            ✕
          </button>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-black text-[#8B949E] uppercase tracking-widest mb-3">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div
                    key={item.keys}
                    className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#30363D]/30 transition-colors"
                  >
                    <span className="text-sm text-[#E6EDF3]">{item.desc}</span>
                    <kbd className="text-xs font-bold text-[#D1D5DB] bg-[#0D1117] border border-[#30363D] rounded px-2 py-1 tabular-nums">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-[#30363D] bg-black/30">
          <p className="text-[11px] text-[#6E7681] text-center">
            Shortcuts are disabled when typing in input fields.
          </p>
        </div>
      </div>
    </div>
  );
}