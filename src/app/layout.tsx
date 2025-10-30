import type { Metadata } from "next";
import { Providers } from "./providers";
// import "./globals.css";

export const metadata: Metadata = {
    title: "IQ Labs DB",
    icons: {
        icon: '/iq_logo.png',
    },
    description: "IQDB provides full CRUD operations, IDs, and extension tables for constructing relational databases. A SQL like database fully hosted on the Solana Blockchain. Using IQLab's novel method for uploading data to the Solana blockchain. User's can create database schemas on Solana using only PDAs and transactions.\n",
};

export default function RootLayout({
                                       children,
                                   }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html>
        <body>
        <Providers >
            {children}
        </Providers>
        </body>
        </html>
    );
}