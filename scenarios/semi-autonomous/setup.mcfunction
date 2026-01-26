# Semi-Autonomous Scenario Setup
# Large 64x64 arena with lava pool in the center

# Force load chunks before modifying them
forceload add -32 -32 31 31

# Set world spawn to safe location near chest (before bot joins)
setworldspawn -10 65 0

# Clear area around spawn (64x64, split into quadrants due to block limits)
fill -32 60 -32 -1 75 -1 air
fill 0 60 -32 31 75 -1 air
fill -32 60 0 -1 75 31 air
fill 0 60 0 31 75 31 air

# Create stone floor (64x64)
fill -32 63 -32 31 63 31 stone

# Create lava pool in the center (10x10 pool)
# Floor is at Y=63, lava is at Y=64 (standing level)
fill -5 64 -5 4 64 4 lava

# Place chest for deposits (on negative X side of lava)
setblock -15 64 0 chest

# Put a pickaxe in the chest
item replace block -15 64 0 container.0 with iron_pickaxe 1

# Set time and weather
time set day
weather clear

# Disable mob spawning
gamerule doMobSpawning false

# Give bot a pickaxe
give Cubert iron_pickaxe 1

# Announce setup complete
say Semi-autonomous scenario ready! 64x64 arena with central lava pool.
