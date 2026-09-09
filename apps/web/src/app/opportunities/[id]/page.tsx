import { redirect } from 'next/navigation';

export default async function OpportunityPermalink({ params }: PageProps<'/opportunities/[id]'>) {
  const { id } = await params;
  redirect(`/?opportunity=${encodeURIComponent(id)}`);
}
