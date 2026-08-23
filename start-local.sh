#!/bin/zsh
# Launcher for the local addon, used by the com.komanmovie.addon LaunchAgent.
#
# Resolves node through nvm rather than baking in a version path, so upgrading
# node doesn't silently leave the agent pointing at a directory that no longer
# exists. dotenv reads .env from the working directory, hence the cd.
set -e

# launchd hands a process a bare PATH that omits Homebrew, so ffprobe/ffmpeg/yt-dlp
# resolve from a login shell but not from the agent. The /dub endpoint failed with
# "spawn ffprobe ENOENT" rather than saying anything about PATH, and the only
# visible symptom was a missing Turkish dub track in the player.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")"
exec node ./index.js
