import { redirect } from "next/navigation";

export default async function ConfigShortcut({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/admin/config/${encodeURIComponent(code)}`);
}
