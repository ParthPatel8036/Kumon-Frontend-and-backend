// src/app/router.jsx
import { createBrowserRouter, Navigate } from "react-router-dom";
import App from "../App";
import Login from "../pages/Login";
import Dashboard from "../pages/Dashboard";
import Scan from "../pages/Scan";
import Messages from "../pages/Messages";
import Templates from "../pages/Templates";
import Students from "../pages/Students";
import Guardians from "../pages/Guardians";
import Users from "../pages/Users";
import Settings from "../pages/Settings";
import AddStudents from "../pages/AddStudents";
import NotFound from "../pages/NotFound";
import ProtectedRoute from "../components/ProtectedRoute";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      // Default to dashboard after login
      { index: true, element: <Navigate to="/dashboard" replace /> },

      { path: "login", element: <Login /> },

      // Authed area
      {
        element: <ProtectedRoute />,
        children: [
          { path: "dashboard", element: <Dashboard /> },
          { path: "scan", element: <Scan /> },
          { path: "messages", element: <Messages /> },
          { path: "students", element: <Students /> },
          { path: "guardians", element: <Guardians /> },
          { path: "settings", element: <Settings /> },

          // Admin-only routes
          {
            element: <ProtectedRoute requireAdmin />,
            children: [
              { path: "templates", element: <Templates /> },
              { path: "users", element: <Users /> },
              { path: "import", element: <AddStudents /> },
            ],
          },
        ],
      },

      { path: "*", element: <NotFound /> },
    ],
  },
]);