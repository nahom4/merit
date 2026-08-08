import type { RunLogView } from '../view-model.js';

/**
 * The system reporting its own health as data. Without it, "the sweep ran" and "the sweep ran
 * and silently degraded on quota exhaustion" look identical from this screen.
 */
export const RunLog = ({ log }: { log: RunLogView }) => (
  <section className="mt-10 rounded border border-line bg-gray-50 p-4" data-testid="run-log">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Run log</h2>
    <ul className="mt-2 space-y-1 text-sm">
      {log.lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  </section>
);
