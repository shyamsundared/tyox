import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRef, useState, type FormEvent } from "react";

export function APITester() {
  const responseInputRef = useRef<HTMLTextAreaElement>(null);
  // Track method state strictly to toggle the request body field visibility
  const [method, setMethod] = useState("GET");

  const testEndpoint = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!responseInputRef.current) return;
    responseInputRef.current.value = "Sending request...";

    try {
      const form = e.currentTarget;
      const formData = new FormData(form);
      const endpoint = formData.get("endpoint") as string;
      
      // Safely construct URL (resolves relative paths to current domain)
      const url = new URL(endpoint, window.location.origin);
      
      const options: RequestInit = { method };

      // Append request body for write methods if content exists
      if (method !== "GET" && method !== "DELETE") {
        const bodyPayload = formData.get("body") as string;
        if (bodyPayload?.trim()) {
          // Validates JSON formatting before shipping it out
          options.body = JSON.stringify(JSON.parse(bodyPayload));
          options.headers = { "Content-Type": "application/json" };
        }
      }

      const res = await fetch(url, options);
      
      // Safely parse content-type (handles text, blank responses, and JSON strings)
      const contentType = res.headers.get("content-type");
      let formattedData: string;

      if (contentType && contentType.includes("application/json")) {
        const data = await res.json();
        formattedData = JSON.stringify(data, null, 2);
      } else {
        formattedData = await res.text();
      }

      responseInputRef.current.value = `Status: ${res.status} ${res.statusText}\n\n${formattedData || "(Empty Response)"}`;
    } catch (error) {
      responseInputRef.current.value = error instanceof Error ? error.message : String(error);
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto p-4">
      <form onSubmit={testEndpoint} className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Label htmlFor="method" className="sr-only">Method</Label>
          <Select name="method" value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-[110px]" id="method">
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
            </SelectContent>
          </Select>

          <Label htmlFor="endpoint" className="sr-only">Endpoint</Label>
          <Input 
            id="endpoint" 
            type="text" 
            name="endpoint" 
            defaultValue="/api/hello" 
            placeholder="/api/hello or https://example.com" 
            className="flex-1"
            required 
          />
          
          <Button type="submit" variant="default">
            Send
          </Button>
        </div>

        {/* Dynamically display JSON payload textarea for POST/PUT */}
        {method !== "GET" && method !== "DELETE" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="body" className="text-xs font-semibold text-muted-foreground">Request Body (JSON)</Label>
            <Textarea
              id="body"
              name="body"
              placeholder='{ "key": "value" }'
              className="font-mono min-h-[80px] text-sm"
            />
          </div>
        )}
      </form>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="response" className="text-xs font-semibold text-muted-foreground">Response Console</Label>
        <Textarea
          ref={responseInputRef}
          id="response"
          readOnly
          placeholder="Response details will print here..."
          className="min-h-[200px] font-mono text-sm bg-muted/30 resize-y"
        />
      </div>
    </div>
  );
}
