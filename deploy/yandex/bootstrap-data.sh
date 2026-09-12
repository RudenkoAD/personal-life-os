#!/bin/bash
set -euo pipefail
# Only the separately provisioned, named empty data disk may be initialized.
device=/dev/disk/by-id/virtio-life-os-data
test -b "$device"
if ! blkid "$device" >/dev/null 2>&1; then
  test "$(blockdev --getsize64 "$device")" -eq 10737418240
  mkfs.ext4 -L life-os-data "$device"
fi
install -d -m 700 /srv/personal-life-os
uuid=$(blkid -s UUID -o value "$device")
if ! grep -q "UUID=$uuid " /etc/fstab; then
  echo "UUID=$uuid /srv/personal-life-os ext4 defaults 0 2" >> /etc/fstab
fi
mountpoint -q /srv/personal-life-os || mount /srv/personal-life-os
install -d -m 700 -o 1000 -g 1000 /srv/personal-life-os/data
install -d -m 700 /srv/personal-life-os/secrets /srv/personal-life-os/backups
install -d -m 755 /opt/personal-life-os
if test ! -e /opt/personal-life-os/secrets; then
  ln -s /srv/personal-life-os/secrets /opt/personal-life-os/secrets
fi
