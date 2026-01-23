# Semi-Autonomous Scenario Setup

# Clear area around spawn
fill -15 60 -15 15 75 15 air

# Create floor
fill -15 63 -15 15 63 15 stone

# Place lava pit at walking level (1 block above ground)
# This creates a 4x4 lava pool that the bot must navigate around
# Floor is at Y=63, lava is at Y=64 (standing level)
fill 5 64 5 8 64 8 lava

# Place chest for deposits
setblock -8 64 0 chest

# Put a pickaxe in the chest
item replace block -8 64 0 container.0 with iron_pickaxe 1

# Set time and weather
time set day
weather clear

# Give bot a pickaxe
give Cubert iron_pickaxe 1

# Announce setup complete
say Semi-autonomous scenario ready! Talk to the bot in chat.
