export default function ModulesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <section className="mx-auto max-w-5xl px-6 py-8">{children}</section>;
}
