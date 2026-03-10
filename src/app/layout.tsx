export const metadata = {
  title: "Atlas Risk Service",
  description: "Risk engine, fraud signals, disputes, evidence, and representment",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
