# MPRIS session-bus access — security decision required

This isolated proposal exposes the existing session bus socket to tonearmd:
`BindReadOnlyPaths=-%t/bus`. It addresses the MPRIS connection regression when
ProtectHome=tmpfs hides the user runtime directory. The optional socket does not
become a required setup-created path. Existing filesystem hardening stays in
place, and no audio, playback or transport-control change is included.

**A read-only filesystem bind does not make D-Bus messages read-only.** This gives
the daemon access to the session bus, including org.freedesktop.systemd1. It may
ask the user manager to start units outside its own sandbox. This is a material
security boundary, not a harmless art/IPC mount.

The maintainer requested an independent marketplace security review, potentially
using a filtered D-Bus proxy instead. This draft preserves the narrow proposed
bind for that decision; it does not implement a filtered proxy or assert that
unrestricted session-bus access is acceptable. Do not treat it as recommended
installation guidance pending that decision.

Tests check optional socket ownership, unchanged hardening, generated unit paths
and setup/uninstall behavior using temporary files and fake commands. No bus
method, unit startup, actual install or live MPRIS test is performed by them.
