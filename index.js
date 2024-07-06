const express = require("express");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const cors = require("cors");
const path = require("path");
const jwt = require("jsonwebtoken");
const fileUpload = require("express-fileupload");
const fs = require('fs');

const app = express();
const prisma = new PrismaClient();

const corsOptions = {
    origin: '*', 
    methods: ['GET', 'POST'], 
    credentials: true, 
};

app.use(express.json());
app.use(cors(corsOptions));
app.use(fileUpload());
app.use("/images", express.static(__dirname + "/images"));

//---------------------------------------VERIFY TOKEN---------------------------------------------------------

const verifyToken = (req, res, next) => {
    const token = req.headers["x-access-token"];

    jwt.verify(token, process.env.SECRET_KEY, (error, decoded) => {
        if (error) {
            res.send({error: "Your session has expired or does not exist!"});
            return;
        } else {
            req.userId = decoded.userId;
            next();
        }
    });
};


app.get("/test", async (req,res) => {
    return "hello it is working"
});

//---------------------------------------CREATE NEW USER---------------------------------------------------------

app.post("/create-new-user", async ( req, res) => {
    const signUpData = req.body;
   
    if (!signUpData.firstName) { return res.send({ error: "First name field cannot be left empty!"}) };
    if (!signUpData.lastName) { return res.send({ error: "last name field cannot be left empty!" }) };
    if (!signUpData.userName) { return res.send({ error: "Username field cannot be left empty!" }) };
    if (!signUpData.email) { return res.send({ error: "Email field cannot be left empty!" }) };
    if (!signUpData.password) { return res.send({ error: "First name field cannot be left empty!" }) };

    const foundUser = await prisma.user.findUnique({
        where: { email: signUpData.email }
    });

    if (foundUser) { return res.send({ error: "Email is already in use!" }) };

    const adminKey = process.env.ADMIN_KEY;
    const hashedPassword = bcrypt.hashSync(signUpData.password, 10);

    try {
        const createdUser = await prisma.user.create({
            data: {
                firstName: signUpData.firstName,
                lastName: signUpData.lastName,
                userName: signUpData.userName,
                email: signUpData.email,
                password: hashedPassword,
                role: signUpData.adminKey === adminKey ? "ADMIN" : "USER"
            }
        });

        res.send({ success: "Created User: " + createdUser.userName + "successfully!"});

    } catch(error) {
        console.log(error);
        return;
    }
});


//--------------------------------------LOGIN---------------------------------------------------------

app.post("/login", async (req,res) => {
    const loginData = req.body;

    if (!loginData.email) { return res.send({ error: "Email field cannot be left empty!" })};
    if (!loginData.password) { return res.send({ error: "Password field cannot be left empty!" })};

    const user = await prisma.user.findUnique({
        where: { email: loginData.email }
    });

    if (!user) { return res.send({ error: "Password or email is incorrect!"}) };

    const passwordValid = await bcrypt.compare(loginData.password, user.password);

    if (!passwordValid) {
        res.send({ error: "Password or email is incorrect!"});
        return;
    };

    const { password, ...userWithoutPass } = user;

    res.send({
        token: jwt.sign({ userId: user.id}, process.env.SECRET_KEY, {expiresIn: "5h"}),
        userWithoutPass
    });
});


//---------------------------------------GET CURRENT USER---------------------------------------------------------

app.get("/get-current-user", verifyToken, async (req,res) => {
    const userId = req.userId;

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                posts: true,
                comments: true,
                likes: true,
                notifications: {
                     orderBy: [
                        { read: 'asc' },
                        { created_at: 'desc' } 
                    ]
                },

            }
        });
        if (!user) { return res.send({error: "User could not be found!"}) };

        const { password, ...userWithoutPass } = user;
        res.send({success: userWithoutPass});

    } catch (error) {
        console.log("Error getting current user :", error);
        return;
    }
});

//---------------------------------------UPDATE USER PROFILE---------------------------------------------------------

app.post("/edit-profile", verifyToken, async (req, res) => {
    const userId = req.userId;
    const updateData = req.body;

    try {
        const user = await prisma.user.findUnique({
            where: { email: updateData.email}
        });
        
        if (!user) { return res.send({ error: "User not found!" }) };

        let hashedPassword;
        if (user.password !== updateData.password) {
            hashedPassword = bcrypt.hashSync(updateData.password, 10);
        };
    
        await prisma.user.update({
            where: { id: userId },
            data: {
                firstName: updateData.firstName || undefined,
                lastName: updateData.lastName || undefined,
                userName: updateData.userName || undefined,
                profilemage: updateData.profilemage || undefined,
                password: hashedPassword ? hashedPassword : undefined
                
            }
        });

        res.send({success: "Profile has been updated!"});

    } catch (error) {
        console.log("Error updating profile :", error);
        res.send({ error: "Something went wrong, try again later!" })
        return;
    }
});

//---------------------------------------GET USER BY ID---------------------------------------------------------

app.post("/get-user", verifyToken, async (req,res) => {
    const userId = req.userId;
    const profileUserId = req.body;

    try {
        const user = await prisma.user.findUnique({
            where: { id: profileUserId.params.userId },
            include: {
                comments:true,
                notifications:true,
                likes:true,
                posts: {
                    include: { image:true }
                }
            }
        });

        if (userId === profileUserId.params.userId) {
            res.send({ user });
        } else {
            const { password, ...userWithoutPass } = user;
            res.send({ user: userWithoutPass });
        };
    } catch (error) {
        console.log("Error getting profile with userId", error);
        res.send({error: "Something went wrong, please try again later!"});
        return;
    }
});

//---------------------------------------CREATE NEW POST---------------------------------------------------------

app.post("/create-post", verifyToken, async (req, res) => {
    const userId = req.userId;
    const postData = req.body;

    try {
        const file = req.files ? req.files.file : null;

        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) { return res.send({ error: "User not found!" }) };

        if (!postData.title) { return res.send({error: "Title field cannot be left empty!"}) };
        if (!postData.description) { return res.send({ error: "Description field cannot be left empty!" }) };
        if (!postData.imageUrl && !file) { return res.send({ error: "You must include either a file or an imageUrl to create a post!" }) };
       
        const createdPost = await prisma.post.create({
            data: {
                title: postData.title,
                description: postData.description,
                imageUrl: postData.imageUrl ? postData.imageUrl: "",
                user: {
                    connect: {
                        id: userId
                    }
                }
            }
        });
       
        if (createdPost && file) {
            const fileExtension = path.extname(file.name);
            const newFileName = `${createdPost.id}${fileExtension}`;
            const newFilePath = path.join(__dirname, 'images', newFileName);

            file.mv(newFilePath, async (error) => {
                if (error) {
                    res.send({ error })
                    return;
                }
            });
            await prisma.imageUpload.create({
                data: {
                    fileName: newFileName,
                    filePath: "/images/" + newFileName,
                    postId: createdPost.id
                }
            })
        }

        res.send({success: "Post created successfully!"});

    } catch (error) {
        console.log("Error creating post : ", error);
        res.send({error: "Something went wrong, try again later!"})
        return;
    }
});

//---------------------------------------GET ALL POSTS---------------------------------------------------------

app.get("/get-posts", async ( req, res ) => {   
    try {
        const posts = await prisma.post.findMany({
            where: {},
            include: {
                likes: true,
                comments: true,
                image: true,
                user: true      
            },
            orderBy: { created_at: "desc" }
        });

        const postsWithoutPasswords = posts.map(post => {
            const { user: { password, ...userWithoutPassword }, ...restPost } = post;
            return {
                ...restPost,
                user: userWithoutPassword
            };
        });

        res.send({ posts: postsWithoutPasswords });

    } catch (error) {
        console.log("Error getting posts : ", error);
        res.send({error: "Error getting posts, try again later!"});
        return;
    }
});

//---------------------------------------GET POST BY ID---------------------------------------------------------

app.post("/get-post", async (req,res) => {
    const { postId } = req.body;

    try {
        if (!postId) { return res.send({error: "Post Id is undefined. Cannot get post!"}) };
        const post = await prisma.post.findUnique({
            where: {id: postId},
            include: {
                user: true,
                comments: {
                    orderBy: {created_at: "desc"},
                    include: { user: true, likes:true }
                },
                likes:true,
                image:true
            }
        });

        if (!post) {
            res.send({error: "Could not find post with that postId!"});
            return;
        };

        const { user: { password, ...userWithoutPassword }, ...restPost } = post;
        const modifiedPost = {
            ...restPost,
            user: userWithoutPassword
        };

        res.send({ post: modifiedPost });

    } catch (error) {
        console.log("error getting post by id: ", error);
        return;
    }
});

//---------------------------------------LIKE POST---------------------------------------------------------

app.post("/like-post", verifyToken, async (req, res) => {
    const userId = req.userId;
    const  { post }  = req.body;

    try {
        const foundPost = await prisma.post.findUnique({
            where: { id: post.id}
        });

        if (!foundPost) { return res.send({error: "Could not find post with that id!"}) };

        const requester = await prisma.user.findUnique({
            where: {id: userId}
        });

        if (!requester) { return res.send({error: "Could not find user with that userId!"}) };

        const like = await prisma.like.findFirst({
            where: { postId: foundPost.id, userId: requester.id }
        });

        if (like) {
            await prisma.like.delete({
                where: { id: like.id }
            });
           res.send({success: "Unliked Post!"});
           return;
        } else {
            await prisma.like.create({
                data: {
                    post: { connect: { id: foundPost.id } },
                    user: { connect: { id: requester.id } }
                }
            });
            
            if (requester.id !== foundPost.userId) {
                await prisma.notification.create({
                    data: {
                        user: { connect: { id: foundPost.userId } },
                        message: `${requester.userName} has liked your post`,
                    }
                })
            }
            res.send({ success: "Liked Post!" });
            return;
        };
    } catch (error) {
        console.log("Error liking or unliking post", error);
        res.send({error: "Something went wrong, please try again later!"});
        return;
    }
});

//--------------------------------------EDIT POST---------------------------------------------------------

app.post("/edit-post", verifyToken, async (req, res) => {
    const userId = req.userId;
    const postData = req.body;

    try {
        const file = req.files ? req.files.file : null;

        const user = await prisma.user.findUnique({
            where: {id: userId}
        });

        if (!user) { return res.send({ error: "User not found!" }) };
        
        if (user.role !== "ADMIN") { return res.send({ error: "Unauthorized edit of post. User not ADMIN!" }) };

        const foundPost = await prisma.post.findUnique({
            where: {id: postData.postId}
        });

        if (!foundPost) { return res.send({ error: "Could not find post to edit!" }) };

        if (!postData.imageUrl && !postData.title && !postData.description && !file) { return res.send({ error: "You must edit atleast one thing!" }) };

        const updatedPost = await prisma.post.update({
            where:{id: foundPost.id},
            data: {
                title: postData.title || undefined,
                description: postData.description || undefined,
                imageUrl: postData.imageUrl || undefined,
            }
        });

        if (updatedPost && file) {
            const fileExtension = path.extname(file.name);
            const newFileName = `${updatedPost.id}${fileExtension}`;
            const newFilePath = path.join(__dirname, 'images', newFileName);

            if (fs.existsSync(newFilePath)) {
                res.send({ error: 'File with that name on this post already exists' });
                return;
            };

            file.mv(newFilePath, async (error) => {
                if (error) {
                    res.send({ error })
                    return;
                }
            });
            await prisma.imageUpload.create({
                data: {
                    fileName: newFileName,
                    filePath: "/images/" + newFileName,
                    postId: updatedPost.id
                }
            });
        };

        res.send({ success: "Post updated successfully!" })

    } catch (error) {
        console.log("Error updateding post :", error);
        res.send({ error: "Something went wrong, try again later!" })
        return;
    }
});

//---------------------------------------DELETE POST--------------------------------------------------------

app.post("/delete-post", verifyToken, async (req, res) => {
    const userId = req.userId;
    const postId = req.body;

    try {
        const deleter = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!deleter) { return res.send({ error: "Could not delete post. User not found!" }) };
        if (deleter.role !== "ADMIN") { return res.send({ error: "User role is not ADMIN, could not delete post!" }) };

        const postToDelete = await prisma.post.findUnique({
            where: { id: postId.postId }
        });

        if (!postToDelete) { return res.send({ error: "Could not find Post to delete!" }) };

        await prisma.post.delete({
            where: { id: postId.postId }
        });

        await prisma.notification.create({
            data: {
                user: { connect: { id: postToDelete.userId } },
                message: `${deleter.id === postToDelete.userId ? "You have":`${deleter.userName} has`}  deleted your post. Title: ${postToDelete.title}`,
            }
        });
        
        res.send({ success: "Post has been deleted!" });

    } catch (error) {
        console.log("Error deleting Post!", error);
        res.send({ error: "Something went wrong deleting post, try again later!" });
        return;
    }
});

//---------------------------------------COMMENT ON POST---------------------------------------------------------

app.post("/comment-post", verifyToken, async (req, res) => {
    const userId = req.userId;
    const commentData = req.body;

    try {
        if (!userId) { return res.send({ error: "You must be signed in to comment on a post!"}) };

        if (commentData.comment.length < 5) { return res.send({error: "You must write atleast 5 letter in your comment!"}) };

        if (!commentData.postId) { return res.send({ error: "Error creating post due to no postId!"}) };

        const post = await prisma.post.findUnique({
            where: { id: commentData.postId },
        });

        if (!post) { return res.send({ error: "Cant find post with that postId!"}) };

        const requester = await prisma.user.findUnique({
            where: { id: userId },
        });  

        if (!requester) { return res.send({error: "User not found!"}) };

        await prisma.comment.create({
            data: {
                post: { connect: { id: post.id }, },
                user: { connect: { id: requester.id }, },
                content: commentData.comment,
            }
        });

        if (requester.id !== post.userId) {
            await prisma.notification.create({
                data: {
                    user: { connect: { id: post.userId } },
                    message: `${requester.userName ? requester.userName : requester.firstName} has commented on your post`,
                }
            });
        };

        res.send({success: "Comment has been added successfully!"});

    } catch (error) {
        console.log("Error commenting on post!", error); 
        res.send({error: "Something went wrong, try again later!"});
        return;
    }
});


//---------------------------------------LIKE COMMENT---------------------------------------------------------

app.post("/like-comment", verifyToken, async (req, res) => {
    const userId = req.userId;
    const { comment } = req.body;

    try {
        const foundComment = await prisma.comment.findUnique({
            where: { id: comment.comment.id }
        });

        if (!foundComment) { return res.send({ error: "Could not find comment with that id!" }) };

        const requester = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!requester) { return res.send({ error: "Could not find user with that userId!" }) };

        const like = await prisma.like.findFirst({
            where: { commentId: foundComment.id, userId: requester.id }
        });

        if (like) {
            await prisma.like.delete({
                where: { id: like.id }
            });
            res.send({ success: "Unliked Post!" });
            return;
        } else {
            await prisma.like.create({
                data: {
                    comment: { connect: { id: foundComment.id } },
                    user: { connect: { id: requester.id } }
                }
            });

            if (requester.id !== foundComment.userId) {
                await prisma.notification.create({
                    data: {
                        user: { connect: { id: foundComment.userId } },
                        message: `${requester.userName} has liked your comment`,
                    }
                })
            }
            res.send({ success: "Liked Comment!" });
            return;
        }
    } catch (error) {
        console.log("Error liking or unliking comment", error);
        res.send({error: "Something went wrong, please try again later!"});
        return;
    }
});


//---------------------------------------EDIT COMMENT---------------------------------------------------------

app.post("/edit-comment", verifyToken, async (req, res) => {
    const userId = req.userId;
    const commentData = req.body;
 
    if (commentData.commentData.content.length < 5) { return res.send({error: "Comment must be atleast 5 letters!"}) };

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) { return res.send({ error: "User not found!" }) };

        const foundComment = await prisma.comment.findUnique({
            where: { id: commentData.commentData.commentId }
        });

        if (user.id !== foundComment.userId) { return res.send({error: "Unautorized edit!"}) };
        if (!foundComment) { return res.send({ error: "Could not find comment to edit!" }) };
        if (commentData.commentData.content === foundComment.content) { return res.send({ error: "No changes to edit!" }) };

        await prisma.comment.update({
            where: { id: foundComment.id },
            data: {
                content: commentData.commentData.content || undefined
            }
        });

        res.send({ success: "Comment updated successfully!" })

    } catch (error) {
        console.log("Error updating comment :", error);
        res.send({ error: "Something went wrong, try again later!" })
        return;
    }
});

//---------------------------------------DELETE COMMENT---------------------------------------------------------

app.post("/delete-comment", verifyToken, async (req,res) => {
    const userId = req.userId;
    const commentId = req.body;

    try {
        const deleter = await prisma.user.findUnique({
            where: {id: userId}
        });

        if (!deleter) { return res.send({error: "Could not delete comment. User not found!"}) };

        if (deleter.role !== "ADMIN") { return res.send({ error: "User role is not ADMIN, could not delete comment!" }) };

        const commentToDelete = await prisma.comment.findUnique({
            where: {id: commentId.commentId}
        });

        if (!commentToDelete) { return res.send({error: "Could not find comment to delete!"}) };

        await prisma.comment.delete({
            where: { id: commentId.commentId }
        });

        res.send({success: "Comment has been deleted!"});
        
    } catch (error) {
        console.log("Error deleting comment!", error);
        res.send({error: "Something went wrong deleting comment, try again later!"});
        return;
    }
});


//---------------------------------------UPDATE NOTIFICATION---------------------------------------------------------

app.post("/update-notification", async (req, res) => {
    const notification = req.body;

    try {
        const notificationToEdit = await prisma.notification.update({
            where: {id: notification.notificationId},
            data: { read: true}
        });

        if (!notificationToEdit) { return res.send({error: "No notification found!"}) };
        
        res.send({success: "Notification read!"})

    } catch (error) {
        console.log("Error editing notification:", error);
        res.send({error: "Something went wrong, please try again later!"});
        return;
    }
});

const port = 5050;

app.listen(port, () => {
    console.log("App running on port: ", port)
});