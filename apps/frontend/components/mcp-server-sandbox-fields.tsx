"use client"

import { ChevronDown, ChevronRight } from "lucide-react"
import { useState } from "react"
import type { UseFormReturn } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { SandboxFormValues } from "@/lib/sandbox-form"

/**
 * Minimal form-values shape the sandbox section depends on. Both the create and
 * edit MCP-server forms expose an identically shaped optional `sandbox` field,
 * so we type the section against just that slice and let call sites pass their
 * full form (a structural cast).
 */
interface SandboxFormShape {
  sandbox?: SandboxFormValues
}

/**
 * The react-hook-form return type the sandbox section expects. Call sites whose
 * full form is a superset of {@link SandboxFormShape} can cast to this.
 */
export type SandboxFieldsForm = UseFormReturn<SandboxFormShape>

interface McpServerSandboxFieldsProps {
  form: SandboxFieldsForm
}

const NUMBER_LIMITS: Array<{
  name: `sandbox.${"memoryMb" | "cpuSec" | "nproc" | "nofile"}`
  label: string
  placeholder: string
}> = [
  { name: "sandbox.memoryMb", label: "Memory limit (MB)", placeholder: "512" },
  { name: "sandbox.cpuSec", label: "CPU time (s)", placeholder: "30" },
  { name: "sandbox.nproc", label: "Max processes", placeholder: "64" },
  { name: "sandbox.nofile", label: "Max open files", placeholder: "1024" },
]

const BOOLEAN_TOGGLES: Array<{
  name: `sandbox.${"enabled" | "network" | "readOnlyRoot"}`
  label: string
}> = [
  {
    name: "sandbox.enabled",
    label: "Enable bubblewrap sandbox (namespace + read-only fs)",
  },
  { name: "sandbox.network", label: "Allow network access" },
  { name: "sandbox.readOnlyRoot", label: "Read-only root filesystem" },
]

export function McpServerSandboxFields({ form }: McpServerSandboxFieldsProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-md border">
      <Button
        type="button"
        variant="ghost"
        className="w-full justify-start px-3"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        Sandbox / Isolation
      </Button>

      {open && (
        <div className="space-y-4 border-t p-3">
          <FormDescription>
            Leaving fields empty inherits the global server defaults (env vars
            MCP_SANDBOX / MCP_LIMIT_*).
          </FormDescription>

          {BOOLEAN_TOGGLES.map((toggle) => (
            <FormField
              key={toggle.name}
              control={form.control}
              name={toggle.name}
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(checked) =>
                        field.onChange(checked === true)
                      }
                    />
                  </FormControl>
                  <FormLabel className="font-normal">{toggle.label}</FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}

          <div className="grid grid-cols-2 gap-4">
            {NUMBER_LIMITS.map((limit) => (
              <FormField
                key={limit.name}
                control={form.control}
                name={limit.name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{limit.label}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        placeholder={limit.placeholder}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
          </div>

          <FormField
            control={form.control}
            name="sandbox.allowPaths"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Extra allowed paths, one per line</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={"/data\n/var/cache"}
                    className="resize-none font-mono text-sm"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
    </div>
  )
}
