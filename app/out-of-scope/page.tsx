import { getPlatform } from "@/core";
import { RegBlock } from "@/components/Evidence";
import { PageHead } from "@/components/ui";

export default function OutOfScopePage() {
  const platform = getPlatform();
  const countries = Array.from(platform.countries.values());
  return (
    <div className="container narrow">
      <PageHead
        eyebrow="Stated out-of-scope position"
        title="GENE-LINK access is commercial by design"
        lede="A user whose intended use is non-commercial is routed here rather than through rules that do not fit them. In Kenya the endemic, rare and threatened stop and the unqualified material transfer agreement requirement belong to the commercial route. In Madagascar the non-commercial route produces a different instrument altogether. Turning away an applicant the law admits is worse than missing a step, so the platform says plainly where its scope ends and records the basis on the case."
      />
      <section className="card">
        <h3>Where each configured country sends a non-commercial user, and why</h3>
        {countries.map((c) => {
          const rule = c.scope.rules.find((r) => r.id === "non_commercial_out_of_scope")!;
          return (
            <div key={c.code} style={{ marginBottom: 12 }}>
              <h4>{c.name}</h4>
              <RegBlock reg={rule.basis} compact />
              <p className="small"><strong>Redirect:</strong> {rule.redirect}</p>
            </div>
          );
        })}
      </section>
      <section className="card flat">
        <h3>Other hard edges</h3>
        <ul className="small stack" style={{ paddingLeft: 18 }}>
          <li><strong>No &ldquo;already proven&rdquo; or purchase exit.</strong> Every regime decides whether its rules apply by asking what the user will do with the material. None asks whether the function was already demonstrated, and none treats buying as an exit.</li>
          <li><strong>No freedom-to-operate or patent screening.</strong> A partial freedom-to-operate opinion is more dangerous than none. IP checkpoints are recorded as duties to be aware of (Class 7), nothing more.</li>
          <li><strong>No physical logistics.</strong> Export and transfer controls are recorded as requirements and documents, not as a shipment workflow.</li>
          <li><strong>No raw sequence files.</strong> Descriptors and metadata only. A DSI exposure flag informs, it never asserts a resolved DSI or Cali Fund obligation.</li>
          <li><strong>No GENE-LINK review queue in the critical path.</strong> Escalation is to the parties&apos; own counsel or a partner-provided adviser.</li>
        </ul>
      </section>
    </div>
  );
}
