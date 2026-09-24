#!/usr/bin/env bash
# Run once aes256chat.org / www / app resolve to 49.12.43.13:
#   1. registers the real domains in Dokploy (landing + web app)
#   2. points the landing's app link back to app.aes256chat.org and redeploys
#   3. restarts Traefik so ACME actually requests the certificates (known Traefik quirk)
#   4. verifies from outside
# Read-only DNS check first; aborts if DNS still points elsewhere (avoids failed ACME challenges).
set -euo pipefail
set -a; . ~/.config/hcloud.env; set +a
H="x-api-key: $DOKPLOY_TOKEN"; D=http://100.115.104.19:3000/api
LANDING=6cPJWFxqnX5_31wEN9Vni; PWA=K6yn5TFEGOo2zaZxFh53v; IP=49.12.43.13

for h in aes256chat.org www.aes256chat.org app.aes256chat.org; do
  got=$(dig +short @1.1.1.1 "$h" A | tail -1)
  [ "$got" = "$IP" ] || { echo "DNS $h → ${got:-nix} (erwartet $IP) — abgebrochen"; exit 1; }
done
echo "DNS ok"

dom() { # app host port
  curl -s -o /dev/null -w "domain $2 → %{http_code}\n" -X POST -H "$H" -H "Content-Type: application/json" "$D/domain.create" \
    -d "{\"applicationId\":\"$1\",\"host\":\"$2\",\"path\":\"/\",\"port\":$3,\"https\":true,\"certificateType\":\"letsencrypt\",\"domainType\":\"application\"}"
}
dom $LANDING www.aes256chat.org 3000
dom $LANDING aes256chat.org 3000
dom $PWA app.aes256chat.org 80

# landing: app link back to the real domain (env untouched, only build args)
curl -s -H "$H" "$D/application.one?applicationId=$LANDING" -o /tmp/wk/land_app.json
python3 - <<'EOF'
import json
a=json.load(open('/tmp/wk/land_app.json'))
json.dump({"applicationId":"6cPJWFxqnX5_31wEN9Vni","env":a.get('env') or '',"buildArgs":"NEXT_PUBLIC_APP_URL=https://app.aes256chat.org\nNEXT_PUBLIC_SITE_URL=https://www.aes256chat.org","buildSecrets":a.get('buildSecrets') or '',"createEnvFile":bool(a.get('createEnvFile'))},open('/tmp/wk/land_env.json','w'))
EOF
curl -s -o /dev/null -w "saveEnvironment → %{http_code}\n" -X POST -H "$H" -H "Content-Type: application/json" "$D/application.saveEnvironment" -d @/tmp/wk/land_env.json
rm -f /tmp/wk/land_app.json /tmp/wk/land_env.json
curl -s -o /dev/null -w "deploy landing → %{http_code}\n" -X POST -H "$H" -H "Content-Type: application/json" "$D/application.deploy" -d "{\"applicationId\":\"$LANDING\"}"

# Traefik only requests certs for new hosts after a restart; back up acme.json first.
ssh root@100.115.104.19 'cp -a /etc/dokploy/traefik/dynamic/acme.json /root/acme.json.bak_$(date +%Y%m%d_%H%M%S) && sleep 20 && docker restart dokploy-traefik >/dev/null && echo traefik restarted'
sleep 40
for u in https://www.aes256chat.org/ https://aes256chat.org/ https://app.aes256chat.org/; do
  curl -s --noproxy '*' -o /dev/null -w "$u → %{http_code} ssl=%{ssl_verify_result}\n" --max-time 25 "$u" || true
done
echo "Danach: Vercel-Projekt löschen, tmp APK-Server (:8765) + ufw-Regel entfernen."
