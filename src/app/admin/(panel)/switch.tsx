/**
 * An on/off switch, named by the visible text beside it (pass that element's id as `labelledBy`). The track is
 * 48×28; on touchscreens its tap area grows to 44px tall (.tap-target).
 */
export function Switch({
  checked,
  onChange,
  labelledBy,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelledBy: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={`tap-target relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors disabled:opacity-60 ${
        checked ? "border-regal bg-regal" : "border-field bg-white"
      }`}
    >
      <span className={`inline-block size-5 rounded-full shadow transition-transform ${checked ? "translate-x-5.5 bg-mint" : "translate-x-0.5 bg-field"}`} />
    </button>
  );
}
