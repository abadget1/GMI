import React from "react";
import MyApp from "./app";
import NextTopLoader from 'nextjs-toploader';
import "./global.css";
import { CustomizerContextProvider } from "./context/customizerContext";


export const metadata = {
  title: "Meridian | Global Market Intelligence",
  description:
    "Real-time composite indices, cross-asset pressure, supply and demand zones, and proximity alerts.",
};

export const viewport = {
  colorScheme: "dark",
  themeColor: "#07111f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="gmi-body">
        <NextTopLoader color="#45d9ff" showSpinner={false} />
        <CustomizerContextProvider>
          <MyApp>{children}</MyApp>
        </CustomizerContextProvider>
      </body>
    </html>
  );
}
