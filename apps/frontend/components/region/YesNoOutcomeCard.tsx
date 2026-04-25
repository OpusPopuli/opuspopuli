/**
 * Symmetric two-column card that shows what a YES vote vs. NO vote
 * concretely does. Intentionally uses the neutral slate palette — no
 * green/red — to avoid framing one outcome as the "good" one. The two
 * columns have identical styling so neither side visually dominates.
 */
export function YesNoOutcomeCard({
  yesOutcome,
  noOutcome,
}: {
  readonly yesOutcome?: string;
  readonly noOutcome?: string;
}) {
  if (!yesOutcome && !noOutcome) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <OutcomeColumn label="A Yes vote means" body={yesOutcome} />
      <OutcomeColumn label="A No vote means" body={noOutcome} />
    </div>
  );
}

function OutcomeColumn({
  label,
  body,
}: {
  readonly label: string;
  readonly body?: string;
}) {
  return (
    <div className="border-2 border-gray-200 rounded-xl p-5">
      <p className="text-xs uppercase tracking-[1.5px] font-extrabold text-[#595959] mb-3">
        {label}
      </p>
      <p className="text-sm text-[#334155] leading-relaxed">
        {body ?? "Not specified in the measure text."}
      </p>
    </div>
  );
}
