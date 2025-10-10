import type { Metadata } from "next";
import { Providers } from "./providers";
// import "./globals.css";

export const metadata: Metadata = {
    title: "IQ Labs DB - React95 Style",
    description: "A retro-styled reader and writer application",
};

export default function RootLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="ko">
        <body>
        <Providers >
            {children}
        </Providers>
        </body>
        </html>
    );
}