import { Fragment } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@si/ui/components/breadcrumb";

type BreadcrumbEntry = { label: string; href?: string };

const routeMap: Record<string, BreadcrumbEntry[]> = {
  "/account": [{ label: "Account" }],
  "/account/sessions": [{ label: "Account", href: "/account" }, { label: "Sessions" }],
  "/account/passkeys": [{ label: "Account", href: "/account" }, { label: "Passkeys" }],
  "/account/api-keys": [{ label: "Account", href: "/account" }, { label: "API Keys" }],
  "/account/providers": [{ label: "Account", href: "/account" }, { label: "Providers" }],
  "/connections": [{ label: "Connections" }],
  "/admin": [{ label: "Admin" }, { label: "Dashboard" }],
  "/admin/users": [{ label: "Admin", href: "/admin" }, { label: "Users" }],
  "/admin/clients": [{ label: "Admin", href: "/admin" }, { label: "OAuth Clients" }],
  "/admin/sessions": [{ label: "Admin", href: "/admin" }, { label: "Sessions" }],
  "/admin/api-keys": [{ label: "Admin", href: "/admin" }, { label: "API Keys" }],
};

function getBreadcrumbs(pathname: string): BreadcrumbEntry[] {
  if (routeMap[pathname]) return routeMap[pathname];

  if (pathname === "/admin/clients/new") {
    return [
      { label: "Admin", href: "/admin" },
      { label: "OAuth Clients", href: "/admin/clients" },
      { label: "New Client" },
    ];
  }

  if (pathname.startsWith("/admin/clients/")) {
    return [
      { label: "Admin", href: "/admin" },
      { label: "OAuth Clients", href: "/admin/clients" },
      { label: "Edit" },
    ];
  }

  return [{ label: "Home" }];
}

export function DashboardBreadcrumb() {
  const pathname = useLocation({ select: (s) => s.pathname });
  const crumbs = getBreadcrumbs(pathname);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={crumb.label}>
              {i > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : crumb.href ? (
                  <BreadcrumbLink render={<Link to={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
