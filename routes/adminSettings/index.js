const verifyAuth = require('../../middlewares/verifyAuth');
const bcrypt = require('bcrypt-nodejs');
const express = require('express');
const { nanoid } = require('nanoid')

const SIGNUP_TOKEN_LENGTH = 32
const SIGNUP_TOKEN_LIFETIME =
  // One week, approximately. Doesn't need to be perfect.
  1000 // milliseconds
  * 60 // seconds
  * 60 // minutes
  * 24 // hours
  * 07 // days

module.exports = (db) => {
  const router = express.Router();

  router.get('/', verifyAuth(), (req, res) => {
    if (!req.user.admin) return res.redirect('/');
    db.allDocs({ include_docs: true })
      .then(docs => {
        res.render('adminSettings', { title: 'Admin Settings', users: docs.rows })
      })
      .catch(err => { throw err; });
  });

  router.post('/add', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/');
    await db.put({
      _id: req.body.newUserUsername.trim(),
      admin: false,
      wishlist: [],

      signupToken: nanoid(SIGNUP_TOKEN_LENGTH),
      expiry: new Date().getTime() + SIGNUP_TOKEN_LIFETIME
        
    });
    res.redirect(`/admin-settings/edit/${req.body.newUserUsername.trim()}`)
  });

  router.get('/edit/:userToEdit', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/');
    const doc = await db.get(req.params.userToEdit)
    delete doc.password
    res.render('admin-user-edit', { user: doc });
  });

  router.post('/edit/refresh-signup-token/:userToEdit', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/');
    const doc = await db.get(req.params.userToEdit)
    doc.signupToken = nanoid(SIGNUP_TOKEN_LENGTH)
    doc.expiry = new Date().getTime() + SIGNUP_TOKEN_LIFETIME
    await db.put(doc)
    return res.redirect(`/admin-settings/edit/${req.params.userToEdit}`)
  });

  router.post('/edit/rename/:userToRename', verifyAuth(), async (req, res) => {
    if (!req.user.admin && req.user._id !== req.params.userToRename) return res.redirect('/')
    if (!req.body.newUsername) {
      req.flash('error', 'No username provided')
      return res.redirect(`/admin-settings/edit/${req.params.userToRename}`)
    }
    if (req.body.newUsername === req.params.userToRename) {
      req.flash('error', 'Username is same as new username.')
      return res.redirect(`/admin-settings/edit/${req.params.userToRename}`)
    }

    const oldName = req.params.userToRename
    const newName = req.body.newUsername

    const userDoc = await db.get(oldName)
    userDoc._id = newName
    delete userDoc._rev
    try {
      await db.put(userDoc)
      try {
        const usersBulk = []
        const users = (await db.allDocs({ include_docs: true })).rows
        for (const { doc: user } of users) {
          for (const item of user.wishlist) {
            if (item.pledgedBy === oldName) item.pledgedBy = newName
            if (item.addedBy === oldName) item.addedBy = newName
          }
          usersBulk.push(user)
        }

        await db.bulkDocs(usersBulk)
        await db.remove(await db.get(oldName))
  
        await req.flash('success', 'Renamed user!')
        return res.redirect(`/wishlist/${newName}`)
      } catch (error) {
        console.log(error, error.stack)
        await db.remove(await db.get(newName))
        throw error
      }
    } catch (error) {
      req.flash('error', error.message)
      return res.redirect(`/admin-settings/edit/${oldName}`)
    }
  })

  router.post('/edit/remove/:userToRemove', verifyAuth(), async (req, res) => {
    if (!req.user.admin) return res.redirect('/');
    const doc = await db.get(req.params.userToRemove);
    if (doc.admin) {
      req.flash('error', 'Failed to remove: user is admin.');
      return res.redirect('/admin-settings');
    }
    await db.remove(doc);
    const docs = await db.allDocs({ include_docs: true });
    for (let i = 0; i < docs.length; i++) {
      for (let j = 0; j < docs[i].doc.wishlist.length; j++) {
        if (docs[i].doc.wishlist[j].pledgedBy === req.params.userToRemove) {
          docs[i].doc.wishlist[j].pledgedBy === undefined;
          if (docs[i].doc.wishlist[j].addedBy === req.params.userToRemove) await db.remove(doc);
          else await db.put(docs[i].doc);
        }
      }
    }
    req.flash('success', `Successfully removed user ${req.params.userToRemove}`);
    res.redirect('/admin-settings')
  });

  return router;
};