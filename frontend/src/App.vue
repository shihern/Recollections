<template>
  <div id="app">
    <Navbar ></Navbar>
    <router-view/>
  </div>
</template>

<script>
import Navbar from '@/components/Navbar';

export default {
  name: 'App',
  components: {
    Navbar
  },
  mounted(){
    console.log(process.env.VUE_APP_BACKEND_URL);
    if(localStorage.getItem('token')){

    }else{
      this.$router.push('/signin');
    }
  },
}
</script>

<style lang="scss">
@import '../node_modules/bootstrap/scss/bootstrap.scss';

#app {
  font-family: 'Avenir', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
}
#nav {
  padding: 30px;
  a {
    font-weight: bold;
    color: #2c3e50;
    &.router-link-exact-active {
      text-decoration: underline;
    }
  }
}
</style>
