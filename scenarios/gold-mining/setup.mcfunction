# Gold Mining Scenario Setup

# Clear area around spawn
fill -15 60 -15 15 75 15 air

# Create floor
fill -15 63 -15 15 63 15 stone

# Place lava pit (danger zone)
fill 5 63 5 8 63 8 air
fill 5 62 5 8 62 8 lava

# Place chest for deposits
setblock -8 64 0 chest

# Set time and weather
time set day
weather clear

# Give bot a pickaxe
give Cubert iron_pickaxe 1

# Announce setup complete
say Gold Mining scenario ready!
