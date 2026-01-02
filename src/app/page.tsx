import { redirect } from "next/navigation";

export default function Home() {
  const slug = process.env.SALE_SLUG ?? "infinex-inx";
  redirect(`/sale/${slug}`);
}
