import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * Toast host. Colors come from the Telegram-bridged CSS variables so toasts
 * match the client theme in both light and dark.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
