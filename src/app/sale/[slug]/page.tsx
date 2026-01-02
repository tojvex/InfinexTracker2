import SaleDashboard from "@/components/SaleDashboard";

export default function SalePage({ params }: { params: { slug: string } }) {
  return <SaleDashboard slug={params.slug} />;
}
