import Link from "next/link";
import { Empty } from "@/components/ui";

export default function Unauthorized() {
  return (
    <div className="container">
      <Empty title="Sign in to continue">
        <p>The prototype uses a persona switcher in place of sign-in. In the MVP this is passkeys, email codes and ORCID.</p>
        <Link className="btn" href="/persona">Choose a persona</Link>
      </Empty>
    </div>
  );
}
