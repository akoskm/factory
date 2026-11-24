import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTheme } from "./theme";
import "./styles.css";

initTheme();

const router = createBrowserRouter([
  {
    path: "/*",
    element: (
      <>
        <App />
        <Toaster />
      </>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </React.StrictMode>,
);
