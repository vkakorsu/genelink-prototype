import { declareObjective } from "@/app/actions";
import { OpenMarker, PageHead } from "@/components/ui";
import { getObjective } from "@/lib/session";

const WANTS = [
  { id: "sell_to_eu_buyer", label: "Sell to an EU buyer" },
  { id: "source_from_south", label: "Source from the South" },
  { id: "find_broker", label: "Find a broker" },
  { id: "get_abs_compliant", label: "Get ABS-compliant" },
  { id: "learn", label: "Learn" },
  { id: "screening_agreement", label: "Screening agreement (either direction)", open: true },
];

export default async function DeclarePage() {
  const current = await getObjective();
  return (
    <div className="container narrow">
      <PageHead
        eyebrow="Declare your journey"
        title="I have … and I want …"
        lede="A different endpoint each visit. The same organisation may act on both sides of the market. What you declare here is transient: it shapes navigation and search for this visit and is captured as a demand signal. It is not a role."
      />
      <form action={declareObjective} className="card">
        <div className="field">
          <label htmlFor="have">I have</label>
          <input id="have" name="have" type="text" defaultValue={current?.have ?? ""} placeholder="e.g. an ex-situ collection with characterised anti-inflammatory activity, or a 2028 product line needing a natural preservative" />
          <div className="hint">Free text. Structured identity fields are hidden by code in public projections. Free text is checked for identifying content before publication.</div>
        </div>
        <fieldset>
          <legend>I want to</legend>
          <div className="radio-list">
            {WANTS.map((w) => (
              <label key={w.id}>
                <input type="radio" name="want" value={w.id} defaultChecked={(current?.want ?? "learn") === w.id} />
                <span>
                  {w.label} {w.open && <OpenMarker title="Held open in Appendix A: whether the screening corridor becomes a declared journey, pending the user journeys note. Captured here so demand is measured." />}
                  {w.open && <span className="small mute"> · open decision, captured to measure demand</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row">
          <button className="btn" type="submit">Continue</button>
          <span className="small mute">Non-commercial intent is handled at case intake, where it routes to a stated out-of-scope position.</span>
        </div>
      </form>
    </div>
  );
}
