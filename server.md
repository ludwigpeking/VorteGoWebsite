# instructions
I have a digital ocean droplet space. I want to run a server on it, which hosts this go game. so we now fully remake the game to an online multiplayer game. the game will be hosted on the server, and players can access it through their browsers.

1. user signup/login/logout is needed.
2. user before login is shown as "guest", who create a game room, and invite other users to play with them, but cannot save the game record.
3. users can also see all the online users(including unregistered anonymous users), and can chat in a global chat room, and can also send private messages to other users.
4. user after login is shown as their username, and can save the game record online.

## required features
- user signup/login/logout
- game room creation and invitation
- online user list
- global chat room
- private messaging
- game record saving for registered users
- game record loading for registered users
## menu redesign for online multiplayer mode. put all the links in the current menu into the menu of the game room. the main interface becomes:
- global chat room, showing the user list, and the game room list.
- login/signup links, it should be minimal, staying at a corner. and not changing the main interface. after login, it should show the username and a logout link instead of login/signup links.
- logout link, shows only when the user is logged in, and should be at the same place as login/signup links.
- a button to create a game room, which will bring the user to the game room interface.