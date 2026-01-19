# Gold Mining Scenario Setup

# Clear area around spawn
fill -15 60 -15 15 75 15 air

# Create floor
fill -15 63 -15 15 63 15 stone

# Place lava pit (danger zone)
fill 5 63 5 8 63 8 air
fill 5 62 5 8 62 8 lava

# Place gold ore deposits (away from lava)
setblock -5 64 -3 gold_ore
setblock -6 64 -5 gold_ore
setblock -3 64 -7 gold_ore
setblock -8 64 -2 gold_ore
setblock -4 63 -6 deepslate_gold_ore
setblock -7 63 -4 deepslate_gold_ore

# Place chest for deposits
setblock -8 64 0 chest

# Set time and weather
time set day
weather clear

# Announce setup complete
say Gold Mining scenario ready!
